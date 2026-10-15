#!/usr/bin/env python3
"""Generate b/<id>.html share pages (Open Graph preview with the booth name) that redirect to ../?booth=<id>."""
import json, html, os
BASE = "https://realwitt.github.io/fair-finder/"
os.makedirs("b", exist_ok=True)
d = json.load(open("data/booths.json")); a = json.load(open("data/atms.json"))
items = [(b["id"], b["name"], (b["newFood"]["name"] + ". " if b.get("newFood") else "") + (b.get("products") or ""), b.get("area") or "") for b in d["booths"]]
items += [(x["id"], "ATM", "ATM location from the fair’s published grounds map (approximate)", "") for x in a["atms"]]
for id_, name, desc, area in items:
    t = html.escape(f"{name} · Fair Finder (unofficial)"); ds = html.escape((f"{area}: " if area else "") + (desc[:150] or "Find it with Fair Finder")) + " · Unofficial guide, not affiliated with the N.C. State Fair."
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{t}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="website"><meta property="og:site_name" content="Fair Finder: Unofficial Guide to the 2026 N.C. State Fair">
<meta property="og:title" content="{t}"><meta property="og:description" content="{ds}">
<meta property="og:url" content="{BASE}b/{id_}.html"><meta property="og:image" content="{BASE}icons/icon-512.png">
<meta name="twitter:card" content="summary"><meta name="description" content="{ds}">
<link rel="canonical" href="{BASE}?booth={id_}">
<meta http-equiv="refresh" content="0;url=../?booth={id_}">
<script>var q=new URLSearchParams(location.search);q.set('booth','{id_}');location.replace('../?'+q.toString());</script>
</head><body><a href="../?booth={id_}">Open {html.escape(name)} in Fair Finder</a></body></html>"""
    open(f"b/{id_}.html", "w").write(page)
print(len(items), "share pages")
