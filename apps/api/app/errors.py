import uuid


class AppError(Exception):
    def __init__(self, code, message, status=400, stage="api", retryable=False):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.stage, self.retryable = stage, retryable

    def body(self, trace=None):
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "stage": self.stage,
                "retryable": self.retryable,
                "trace_id": trace or str(uuid.uuid4()),
            }
        }
