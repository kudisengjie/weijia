class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = "REQUEST_FAILED") -> None:
        super().__init__(message)
        self.status = status
        self.code = code
