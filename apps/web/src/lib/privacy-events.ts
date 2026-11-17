const eventName = "personal-memory-invalidated";
export function invalidatePersonalData() {
  window.dispatchEvent(new Event(eventName));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(eventName);
    channel.postMessage("invalidate");
    channel.close();
  }
}
export function onPersonalDataInvalidated(callback: () => void) {
  window.addEventListener(eventName, callback);
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(eventName)
      : undefined;
  if (channel) channel.onmessage = callback;
  return () => {
    window.removeEventListener(eventName, callback);
    channel?.close();
  };
}
