import json


def size(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


class MemoryBudget:
    def __init__(self, limit):
        self.limit, self.used, self.seen = limit, 0, set()

    def select(self, items, limit=None):
        selected, rejected = [], []
        available = min(self.limit - self.used, limit if limit is not None else self.limit)
        for item in items:
            key = (item["id"], item.get("version"))
            if key in self.seen:
                continue
            cost = size(item) + 1
            if cost > available:
                rejected.append(item["id"])
                continue
            self.seen.add(key)
            selected.append(item)
            self.used += cost
            available -= cost
        return selected, rejected
