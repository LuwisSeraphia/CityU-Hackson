"""Compatibility rules; only the planning layer owns intent heuristics."""

import re


def personal_advice(text):
    return bool(
        re.search(r"我|给我|帮我", text)
        and re.search(
            r"学什么|学习.*什么|可以学|可以.*学习|适合.*学|学习.*建议|学习.*计划|学习.*方向|怎么学|如何学",
            text,
        )
    )


def profile_review_scope(text):
    """Conservative self-directed review intent, independent of response wording."""
    if personal_advice(text):
        return "learning_advice"
    if not re.search(r"我的|我是什么|我是.*人|总结.*我|评价.*我|了解我|分析.*我|我的画像", text):
        return None
    if not re.search(r"总结|回顾|画像|性格|习惯|评价|了解|分析|怎么样|什么样", text):
        return None
    if re.search(r"这篇|文章|文档|这个角色|他的|她的", text):
        return None
    for pattern, category in (
        ("学习", "learning"),
        ("作息|生活", "lifestyle"),
        ("目标", "goal"),
        ("沟通", "communication"),
    ):
        if re.search(pattern, text) and not re.search("全面|综合|整体|性格|画像", text):
            return category
    return "all"


def response_strategy(text):
    if re.search("不用.*建议|别.*建议|听我说|吐槽", text):
        return "listen"
    if re.search("直接.*(方案|办法)|怎么办|给我.*建议", text):
        return "plan"
    if re.search("报错|bug|错误堆栈", text, re.I):
        return "troubleshoot"
    if re.search("难过|伤心|烦躁|很累|好烦", text):
        return "listen"
    if re.search("开心|成功了|太棒了", text):
        return "celebrate"
    return "explain"
