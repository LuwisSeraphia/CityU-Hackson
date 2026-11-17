"""Deterministic candidate decisions; never changes extraction prompts."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import re


def review_reasons(data, previous=None):
    reasons = []
    if data['sensitivity'] == 'private' or data['subject'] != 'self':
        reasons.append('sensitive_or_other_subject')
    if data['assertion_kind'] == 'inferred' or data['temporal_status'] == 'uncertain':
        reasons.append('inferred_or_uncertain')
    if previous and previous.content != data['content']:
        reasons.append('conflicting_fact')
    return reasons


def time_fields(data, recorded_at, timezone='Asia/Shanghai'):
    result = {'recorded_at': recorded_at, 'event_timezone': timezone,
              'event_time_source': 'unknown', 'event_time_precision': 'unknown'}
    # Resolve only the candidate's exact evidence, never unrelated clauses in the source.
    evidence = data['evidence']
    relative = set(re.findall(r'今天|昨天|前天', evidence))
    if data["kind"] != "episode":
        result["event_time"] = data.get("event_time")
        return result
    if len(relative) == 1:
        day = datetime.fromisoformat(recorded_at).astimezone(ZoneInfo(timezone)).date()
        day -= timedelta(days={'今天': 0, '昨天': 1, '前天': 2}[next(iter(relative))])
        result.update(event_time=day.isoformat(), event_time_precision='day', event_time_source='relative_expression')
    elif not data.get('event_time'):
        result['event_time'] = None
    else:
        # Existing extracted times are retained but not promoted to verified precision.
        result['event_time_source'] = 'extracted_unverified'
    return result


def transient(data):
    if re.search(r'每当|通常|总是|时喜欢|时候喜欢|偏好|习惯', data['content']):
        return False
    return bool(re.search(r'今天|昨天|前天|刚刚|此刻', data['evidence']) and
                re.search(r'心情|难过|开心|焦虑|情绪|疲惫', data['content']))
