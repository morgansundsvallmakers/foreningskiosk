export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export class ValidationError extends HttpError {
  constructor(message) {
    super(400, message)
    this.name = 'ValidationError'
  }
}
