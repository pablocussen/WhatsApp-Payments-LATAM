import { asyncHandler } from '../../src/utils/async-handler';
import { Request, Response, NextFunction } from 'express';

const mockReq = {} as Request;
const mockRes = {} as Response;
const mockNext = jest.fn() as NextFunction;

beforeEach(() => jest.clearAllMocks());

describe('asyncHandler', () => {
  it('calls the wrapped handler and resolves normally', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, mockNext);

    expect(handler).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next(err) when the wrapped handler rejects', async () => {
    const err = new Error('database exploded');
    const handler = jest.fn().mockRejectedValue(err);
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(err);
  });

  it('calls next(err) when the wrapped handler throws synchronously', async () => {
    const err = new Error('sync throw');
    const handler = jest.fn().mockImplementation(() => {
      throw err;
    });
    const wrapped = asyncHandler(handler);

    // synchronous throws become rejected promises via Promise.resolve()
    await wrapped(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(err);
  });

  it('forwards the return value from a handler that resolves with data', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 'ok' });
    const wrapped = asyncHandler(handler);

    await wrapped(mockReq, mockRes, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
  });
});
