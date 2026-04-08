#!/usr/bin/env python3
"""Search RAG API for podcast quotes. Usage: python tools/search-rag.py "query" [limit]"""
import sys, os, json, urllib.request, urllib.parse

query = sys.argv[1] if len(sys.argv) > 1 else ""
limit = sys.argv[2] if len(sys.argv) > 2 else "5"

if not query:
    print(json.dumps({"error": "Usage: search-rag.py 'query' [limit]"}))
    sys.exit(1)

url = os.environ.get("RAG_API_URL", "http://host.docker.internal:3000")
token = os.environ.get("RAG_API_TOKEN", "")
params = urllib.parse.urlencode({"q": query, "limit": limit})

req = urllib.request.Request(
    f"{url}/api/rag/search?{params}",
    headers={"x-rag-api-token": token},
)

try:
    resp = urllib.request.urlopen(req, timeout=10)
    data = json.loads(resp.read())
    results = data.get("results", [])
    for r in results:
        print(f'- "{r.get("quote", "")}"')
        print(f'  Speaker: {r.get("speakerName", "?")}, Episode: {r.get("episodeTitle", "")}')
        print(f'  URL: {r.get("episodeUrl", "")}')
        print()
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
