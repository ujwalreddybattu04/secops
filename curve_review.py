"""Deterministic review of verified monthly results; never alters the smoother.

Detection is descriptive, not a statistical test or a forecast confidence score.
All accuracy checks use raw values; display rounding is measured separately.
"""
import ast
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import inspect
import math
import statistics

import smoothing
from outputs import formatted_monthly, format_percentage

REVIEW_VERSION = 1
SHARP_RANGE_FRACTION = 0.25
SHARP_MEDIAN_MULTIPLIER = 2.0
TURN_NOISE_FRACTION = 1e-9
MAX_EVENTS = 200


def calculation_settings():
    # Read actual solver keyword values, so a later settings change cannot leave
    # a plausible but stale duplicate in the saved calculation record.
    tree = ast.parse(inspect.getsource(smoothing._solve_smoothing))
    solve = next(n for n in ast.walk(tree) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Attribute) and n.func.attr == "solve")
    solver = {kw.arg: ("OSQP" if kw.arg == "solver" else ast.literal_eval(kw.value))
              for kw in solve.keywords}
    return {
        "solver": solver,
        "average": {"range_penalty_weight": smoothing.RANGE_PENALTY_WEIGHT,
                    "first_month_floor": smoothing.FIRST_MONTH_FLOOR,
                    "first_month_fraction_of_positive_max": smoothing.FIRST_MONTH_FRACTION},
        "exit": {"first_month_minimum": 0, "single_year": "flat for non-negative targets"},
        "verification": {"relative_tolerance": str(smoothing.MEAN_RELATIVE_TOLERANCE),
                         "target_scale_floor": str(smoothing.MEAN_ABSOLUTE_FLOOR)},
        "detection": {"sharp_range_fraction": SHARP_RANGE_FRACTION,
                      "sharp_median_multiplier": SHARP_MEDIAN_MULTIPLIER,
                      "turn_noise_fraction": TURN_NOISE_FRACTION,
                      "max_events_per_kind_per_series": MAX_EVENTS},
    }


def decimal_text(value):
    """Decimal strings preserve finite differences even beyond float64 range."""
    return str(value)


def turning_points(values, labels):
    """Collapse flat plateaus and ignore changes below a relative noise floor.

    A reversal is assigned to the first plateau point and includes the plateau
    endpoint, rather than manufacturing multiple turns on a flat maximum.
    """
    scale = max((abs(v) for v in values), default=0) or 1
    normalized = [v / scale for v in values]
    span = max(normalized) - min(normalized)
    noise = max(span * TURN_NOISE_FRACTION, 1e-12)
    result, direction, last_moving = [], 0, None
    for index in range(1, len(values)):
        difference = normalized[index] - normalized[index - 1]
        sign = 1 if difference > noise else -1 if difference < -noise else 0
        if not sign:
            continue
        if direction and sign != direction:
            first = last_moving
            result.append({"kind": "peak" if direction > 0 else "trough",
                           "index": first, "end_index": index - 1,
                           "at": labels[first], "through": labels[index - 1],
                           "value": values[first]})
        direction, last_moving = sign, index
    return result


def sharp_changes(targets, years):
    scale = max(map(abs, targets)) or 1
    normalized = [v / scale for v in targets]
    span = max(normalized) - min(normalized)
    noise = max(span * TURN_NOISE_FRACTION, 1e-12)
    differences = [right - left for left, right in zip(normalized, normalized[1:])]
    nonzero = [abs(value) for value in differences if abs(value) > noise]
    median = statistics.median(nonzero) if nonzero else 0
    threshold = max(SHARP_RANGE_FRACTION * span, SHARP_MEDIAN_MULTIPLIER * median, noise)
    events = []
    with localcontext() as context:
        context.prec = 800
        for index, difference in enumerate(differences):
            if abs(difference) >= threshold and abs(difference) > noise:
                change = Decimal(str(targets[index + 1])) - Decimal(str(targets[index]))
                events.append({"kind": "sharp_rise" if change > 0 else "sharp_fall",
                               "from_year": years[index], "to_year": years[index + 1],
                               "index": (index + 1) * 12, "change": decimal_text(change)})
    return events, {"normalized_threshold": threshold, "normalization_scale": scale,
                    "nonzero_change_median_normalized": median}


def method_review(data, monthly, columns, mode):
    years = [int(value) for value in data["year"]]
    labels = [{"year": int(row[0]), "month": int(row[1])}
              for row in monthly.itertuples(index=False, name=None)]
    series = []
    with localcontext() as context:
        context.prec = 800
        for column_index, column in enumerate(columns):
            targets = data[column].tolist()
            # Positions preserve literal headers, including '__proto__'.
            values = monthly.iloc[:, column_index + 2].tolist()
            if not all(math.isfinite(v) for v in values):
                raise ValueError(f"Column '{column}' produced a non-finite result.")
            annual = []
            for index, target_value in enumerate(targets):
                target = Decimal(str(target_value))
                block = values[index * 12:index * 12 + 12]
                mean = sum((Decimal(str(v)) for v in block), Decimal(0)) / 12
                december = Decimal(str(block[-1]))
                actual = mean if mode == "average" else december
                error = abs(actual - target)
                tolerance = max(abs(target), smoothing.MEAN_ABSOLUTE_FLOOR) * smoothing.MEAN_RELATIVE_TOLERANCE
                display = [Decimal(format_percentage(v).removesuffix("%")) for v in block]
                displayed = sum(display, Decimal(0)) / 12 if mode == "average" else display[-1]
                annual.append({"year": years[index], "target": target_value,
                               "raw_mean": decimal_text(mean), "raw_december": decimal_text(december),
                               "raw_error": decimal_text(error), "tolerance": decimal_text(tolerance),
                               "passed": error < tolerance,
                               "display_error": decimal_text(abs(displayed - target))})
            low, high = min(targets), max(targets)
            minimum, maximum = min(values), max(values)
            floor = max(smoothing.FIRST_MONTH_FLOOR,
                        smoothing.FIRST_MONTH_FRACTION * max(high, 0)) if mode == "average" else 0
            scale = max(max(map(abs, targets)), smoothing.FIRST_MONTH_FLOOR, floor) / 100
            normalized = [v / scale for v in values]
            curvature = math.fsum((c - 2*b + a)**2 for a, b, c in zip(normalized, normalized[1:], normalized[2:]))
            penalty = smoothing.RANGE_PENALTY_WEIGHT * math.fsum(
                max(low / scale - v, 0)**2 + max(v - high / scale, 0)**2 for v in normalized
            ) if mode == "average" else 0
            sharp, threshold = sharp_changes(targets, years)
            yearly_turns = turning_points(targets, [{"year": year} for year in years])
            monthly_turns = turning_points(values, labels)
            series.append({"column": column, "input_min": low, "input_max": high,
                           "solution_kind": "flat fallback" if all(v == targets[0] for v in targets)
                           and targets[0] >= floor else "optimization",
                           "monthly_min": minimum, "monthly_max": maximum,
                           "below_range": decimal_text(max(Decimal(str(low)) - Decimal(str(minimum)), Decimal(0))),
                           "above_range": decimal_text(max(Decimal(str(maximum)) - Decimal(str(high)), Decimal(0))),
                           "first_month": values[0], "first_month_minimum": floor,
                           "first_month_passed": values[0] >= floor,
                           "first_month_near_floor": abs(values[0] / scale - floor / scale) <= 1e-7,
                           "curvature_cost_normalized": curvature, "range_cost_normalized": penalty,
                           "annual_checks": annual,
                           "sharp_changes": sharp[:MAX_EVENTS], "sharp_rule": threshold,
                           "yearly_turns": yearly_turns[:MAX_EVENTS],
                           "monthly_turns": monthly_turns[:MAX_EVENTS],
                           "event_counts": {"sharp_changes": len(sharp), "yearly_turns": len(yearly_turns),
                                            "monthly_turns": len(monthly_turns)}})
    return {"status": "available", "mode": mode,
            "rows": formatted_monthly(monthly).to_dict(orient="records"),
            "series": series,
            "validation": {"finite_values": True, "annual_targets": all(
                check["passed"] for item in series for check in item["annual_checks"]),
                "first_month": all(item["first_month_passed"] for item in series),
                "checked_values": len(monthly) * len(columns)}}


def review_document(data, columns, methods, engine):
    return {"schema": "interpolation-review", "version": REVIEW_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(), "engine": engine,
            "source": {"columns": columns, "rows": data.to_dict(orient="records")},
            "settings": calculation_settings(), "methods": methods,
            "limits": ["Sharp-change flags are descriptive rules, not statistical significance.",
                       "Turning points are measured at monthly resolution; no continuous-curve guarantee.",
                       "Soft ranges are preferences, not hard limits; no fixed 0–100 bound.",
                       "Accuracy checks use raw values. Exports display two decimal places."]}


def influence_document(before, after, column, year, old, new, mode, engine):
    with localcontext() as context:
        context.prec = 800
        deltas = [Decimal(str(b)) - Decimal(str(a)) for a, b in
                  zip(before.iloc[:, 2], after.iloc[:, 2])]
        index = max(range(len(deltas)), key=lambda i: abs(deltas[i]))
        return {"schema": "interpolation-influence", "version": REVIEW_VERSION,
                "engine_id": engine["id"], "mode": mode, "column": column,
                "year": year, "before_target": old, "after_target": new,
                "target_change": decimal_text(Decimal(str(new)) - Decimal(str(old))),
                "largest_monthly_change": decimal_text(deltas[index]),
                "at": {"year": int(before.iloc[index, 0]), "month": int(before.iloc[index, 1])},
                "monthly_changes": [decimal_text(v) for v in deltas],
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "interpretation": "One-target perturbation with all other targets held fixed. "
                                  "Data-dependent range preferences and first-month floors are recomputed. "
                                  "This measures a model response, not a causal effect or a linear forecast."}
