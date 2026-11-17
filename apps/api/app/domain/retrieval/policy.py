"""Conservative read policies; no mutations of stored memories."""

import re


def operation_only(text):
    return bool(
        re.search(
            r"(?:请|要求|希望|帮我|用户要求).{0,8}(?:忘记|删除|清除).{0,30}(?:记忆|偏好|记录)", text
        )
    )


def communication_preference(text):
    return (
        not operation_only(text)
        and not re.search("写论文|写代码|工作时|项目|如果|的时候", text)
        and bool(re.search("喜欢|偏好|希望|习惯", text))
        and bool(re.search("回答|回复|解释|先给结论|步骤|简体中文|英文回答", text))
    )


def needs_memory(text):
    if re.search("我的|我之前|我以前|我喜欢|我现在|我的安排|按我|结合我|还记得|帮我安排", text):
        return True
    return bool(
        re.search("该项目|这个项目|当前|现在|之前|以前", text)
        and re.search("安排|下一步|时间|进展|计划|截止|偏好", text)
    )
