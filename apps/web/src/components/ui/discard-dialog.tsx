"use client";
import { Modal } from "./modal";
import { Button } from "./button";

export function DiscardDialog({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal title="放弃未保存的内容？" onClose={onKeep}>
      <div className="dialog-body">
        <p>关闭后，尚未提交的修改将丢失。</p>
        <div className="form-actions">
          <Button onClick={onKeep}>继续编辑</Button>
          <Button className="danger-button" onClick={onDiscard}>
            放弃修改
          </Button>
        </div>
      </div>
    </Modal>
  );
}
