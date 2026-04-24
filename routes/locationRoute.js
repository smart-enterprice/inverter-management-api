import express from "express";
import { LOCATIONS } from "../data/locations.js";

const router = express.Router();

// normalize states only (not UT)
const normalizedStates = {};
for (const key of Object.keys(LOCATIONS)) {
    if (key === "Union_Territories") continue;
    const lower = key.toLowerCase();
    normalizedStates[lower] = { name: key, districts: {} };

    for (const d of Object.keys(LOCATIONS[key].districts)) {
        normalizedStates[lower].districts[d.toLowerCase()] = {
            name: d,
            cities: LOCATIONS[key].districts[d]
        };
    }
}

router.get("", (req, res) => {
    res.json(LOCATIONS);
});

router.get("/regions", (req, res) => {
    const states = Object.keys(LOCATIONS).filter(x => x !== "Union_Territories");
    const uts = Object.keys(LOCATIONS.Union_Territories || {});
    res.json({ states, union_territories: uts });
});

router.get("/districts", (req, res) => {
    const raw = req.query.state?.trim();
    if (!raw) return res.status(400).json({ error: "Missing state" });

    const key = raw.toLowerCase();

    const st = normalizedStates[key];
    const utRoot = LOCATIONS.Union_Territories || {};
    const utName = Object.keys(utRoot).find(u => u.toLowerCase() === key);

    if (st) {
        return res.json(Object.values(st.districts).map(x => x.name));
    }

    if (utName) {
        return res.json(Object.keys(utRoot[utName].districts));
    }

    return res.status(400).json({ error: "Invalid state or union territory" });
});

// ------------------------------------------------------
// /cities
// ------------------------------------------------------
router.get("/cities", (req, res) => {
    const rawState = req.query.state?.trim();
    const rawDistrict = req.query.district?.trim();
    if (!rawState || !rawDistrict) {
        return res.status(400).json({ error: "Missing params" });
    }

    const sKey = rawState.toLowerCase();
    const dKey = rawDistrict.toLowerCase();

    const st = normalizedStates[sKey];
    const utRoot = LOCATIONS.Union_Territories || {};
    const utName = Object.keys(utRoot).find(u => u.toLowerCase() === sKey);

    if (st) {
        const match = st.districts[dKey];
        if (!match) return res.status(400).json({ error: "Invalid district" });
        return res.json(match.cities);
    }

    if (utName) {
        const list = utRoot[utName].districts[rawDistrict];
        if (!list) return res.status(400).json({ error: "Invalid district" });
        return res.json(list);
    }

    return res.status(400).json({ error: "Invalid state or union territory" });
});

export default router;