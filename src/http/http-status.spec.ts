import { describe, expect, it } from 'vitest';
import { HttpStatus } from './http-status.js';

describe('HttpStatus', () => {
  it('標準の代表的なコード値を持つ', () => {
    expect(HttpStatus.OK).toBe(200);
    expect(HttpStatus.CREATED).toBe(201);
    expect(HttpStatus.NO_CONTENT).toBe(204);
    expect(HttpStatus.NOT_MODIFIED).toBe(304);
    expect(HttpStatus.BAD_REQUEST).toBe(400);
    expect(HttpStatus.UNAUTHORIZED).toBe(401);
    expect(HttpStatus.FORBIDDEN).toBe(403);
    expect(HttpStatus.UNPROCESSABLE_ENTITY).toBe(422);
    expect(HttpStatus.INTERNAL_SERVER_ERROR).toBe(500);
  });
});
