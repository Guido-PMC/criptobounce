export class MexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MexError';
  }
}

export class MexNetworkError extends MexError {
  public readonly originalCause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MexNetworkError';
    this.originalCause = cause;
  }
}

export class MexBusinessError extends MexError {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly mexCode?: number | string,
    public readonly mexMessage?: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'MexBusinessError';
  }

  /**
   * MEX returns code -2010 / msg containing "duplicated" for client-side dedup hits
   * on withdrawOrderId. Adjust as we observe real codes.
   */
  get isDedupHit(): boolean {
    const m = (this.mexMessage ?? '').toLowerCase();
    return (
      m.includes('duplicate') ||
      m.includes('already exists') ||
      this.mexCode === 700013 ||
      this.mexCode === -2010
    );
  }

  get isAssetDisabled(): boolean {
    const m = (this.mexMessage ?? '').toLowerCase();
    return (
      m.includes('withdrawal disabled') ||
      m.includes('not enabled') ||
      m.includes('temporarily closed') ||
      m.includes('maintenance')
    );
  }

  get isInsufficientBalance(): boolean {
    const m = (this.mexMessage ?? '').toLowerCase();
    return m.includes('insufficient') || this.mexCode === 30005;
  }

  get isRetryable(): boolean {
    if (this.httpStatus >= 500) return true;
    if (this.httpStatus === 429) return true;
    if (this.isInsufficientBalance) return false;
    if (this.isDedupHit) return false;
    if (this.isAssetDisabled) return false;
    return false;
  }
}
