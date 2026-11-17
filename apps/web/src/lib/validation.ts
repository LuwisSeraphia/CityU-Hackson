export const MAX_INPUT_LENGTH = 4000;
export function validateMessage(text: string): string | undefined {
  if (!text.trim()) return "请先输入想提问或记录的内容。";
  if (text.length > MAX_INPUT_LENGTH)
    return `内容不能超过 ${MAX_INPUT_LENGTH} 字，请缩短后再发送。`;
  if (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{20,}|(?:api[_ -]?key|password|密码|密钥)\s*[:：=]\s*\S{6,}/i.test(
      text,
    )
  )
    return "检测到疑似密码、API Key 或私钥。请移除凭据后再提交。";
}
