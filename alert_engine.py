GREEN_MAX=5
YELLOW_MAX=15
ORANGE_MAX=30
DISASTER_ESCALATE=10
ACTIONS = {
    "GREEN": "Normal NavIC operations",
    "YELLOW": "Use dual-frequency (L5 + S) correction",
    "ORANGE": "Keep manual navigation backup ready",
    "RED": "Halt NavIC-dependent rescue ops; use alternative positioning",
}
COLORS ={
            "GREEN": "#2e7d32",
    "YELLOW": "#f9a825",
    "ORANGE": "#ef6c00",
    "RED": "#c62828",
    }
LEVEL_ORDER = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}
DISASTER_ZONES = [
    {"name": "Kerala Floods", "type": "flood", "lat": 10.0, "lon": 76.3, "active": True},
     {"name": "Odisha Cyclone", "type": "cyclone", "lat": 19.8, "lon": 85.8, "active": True},
         {"name": "Assam Floods", "type": "flood", "lat": 26.2, "lon": 92.9, "active": True},
          {"name": "Mumbai Region", "type": "urban", "lat": 19.1, "lon": 72.9, "active": False},
]
def classify_alert(error_m, disaster_active):
    if error_m > ORANGE_MAX and disaster_active:
        return "RED"
    elif error_m > YELLOW_MAX or (error_m > DISASTER_ESCALATE and disaster_active):
        return "ORANGE"
    elif error_m > GREEN_MAX:
        return "YELLOW"
    else:
        return "GREEN"
def severity(alert):
    return LEVEL_ORDER[alert["level"]]
def evaluate_zones(error_m):
    alerts = []
    for zone in DISASTER_ZONES:
        level = classify_alert(error_m, zone["active"])
        alert = {
            "name": zone["name"],
            "type": zone["type"],
            "lat": zone["lat"],
            "lon": zone["lon"],
            "error_m": error_m,
            "level": level,
            "action": ACTIONS[level],
            "color": COLORS[level],
        }
        alerts.append(alert)
        alerts.sort(key=severity, reverse=True)
    return alerts
  

    