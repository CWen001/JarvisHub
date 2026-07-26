#!/usr/bin/env python3
"""Search a local ComponentCard index used by agents-cli retrieval tools."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


TOKEN_RE = re.compile(r"[a-z0-9]+")


def read_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def tokenize(value: str) -> set[str]:
    return set(TOKEN_RE.findall(value.lower()))


def flatten_for_search(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(flatten_for_search(item) for item in value)
    if isinstance(value, dict):
        return " ".join(flatten_for_search(item) for item in value.values())
    return ""


def read_records(index_path: Path) -> list[dict[str, Any]]:
    parsed = json.loads(index_path.read_text(encoding="utf-8"))
    records = parsed.get("records") if isinstance(parsed, dict) else parsed
    if not isinstance(records, list):
        raise ValueError("ComponentCard index must be a JSON array or an object with records[].")
    return [item for item in records if isinstance(item, dict)]


def matches_filter(record: dict[str, Any], key: str, expected: str | None) -> bool:
    if not expected:
        return True
    expected_normalized = expected.lower()
    direct = read_text(record.get(key)).lower()
    if direct == expected_normalized:
        return True
    candidate = record.get("componentReferencePlanCandidate")
    if isinstance(candidate, dict) and read_text(candidate.get(key)).lower() == expected_normalized:
        return True
    values = record.get(f"{key}s")
    if isinstance(values, list):
        return expected_normalized in {read_text(item).lower() for item in values}
    return False


def score_record(record: dict[str, Any], query: str, query_tokens: set[str]) -> tuple[int, str]:
    haystack = flatten_for_search(record)
    haystack_lower = haystack.lower()
    haystack_tokens = tokenize(haystack)
    overlap = len(query_tokens & haystack_tokens) * 10
    frequency = sum(haystack_lower.count(token) for token in query_tokens)
    phrase_bonus = 25 if query and query.lower() in haystack_lower else 0
    candidate = record.get("componentReferencePlanCandidate")
    title = read_text(record.get("title")) or read_text(record.get("id"))
    if isinstance(candidate, dict):
        title = read_text(candidate.get("name")) or read_text(candidate.get("referenceId")) or title
    return overlap + frequency + phrase_bonus, title


def search(args: argparse.Namespace) -> dict[str, Any]:
    records = read_records(Path(args.index))
    query = read_text(args.query)
    query_tokens = tokenize(query)
    filtered = [
        record
        for record in records
        if matches_filter(record, "category", args.category)
        and matches_filter(record, "dependency", args.dependency)
        and matches_filter(record, "assetSlot", args.asset_slot)
    ]
    scored = [
        (score, title, index, record)
        for index, record in enumerate(filtered)
        for score, title in [score_record(record, query, query_tokens)]
        if score > 0 or not query_tokens
    ]
    scored.sort(key=lambda item: (-item[0], item[1].lower(), item[2]))
    results = [record for _score, _title, _index, record in scored[: args.top_k]]
    return {
        "query": query,
        "topK": args.top_k,
        "filters": {
            "category": args.category,
            "dependency": args.dependency,
            "assetSlot": args.asset_slot,
        },
        "results": results,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Search a local ComponentCard index.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("--index", required=True)
    search_parser.add_argument("--query", required=True)
    search_parser.add_argument("--top-k", type=int, default=10)
    search_parser.add_argument("--category")
    search_parser.add_argument("--dependency")
    search_parser.add_argument("--asset-slot")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "search":
        payload = search(args)
        json.dump(payload, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    parser.error(f"unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
