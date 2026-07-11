import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { reopenGuardedPaymentFailedSet } from './payment-failed.js';

const dialect = new MySqlDialect();
const render = (frag: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(frag).sql;

describe('reopenGuardedPaymentFailedSet', () => {
  const set = reopenGuardedPaymentFailedSet();

  it('status は resolved を据え置き、それ以外は新値（再オープンしない）', () => {
    expect(render(set.status)).toBe(
      "IF(`payment_failed`.`status` = 'resolved', `payment_failed`.`status`, values(`status`))",
    );
  });

  it('receipt も resolved 行は据え置き', () => {
    expect(render(set.receipt)).toBe(
      "IF(`payment_failed`.`status` = 'resolved', `payment_failed`.`receipt`, values(`receipt`))",
    );
  });

  it('type/user_id は無条件更新', () => {
    expect(render(set.type)).toBe('values(`type`)');
    expect(render(set.userId)).toBe('values(`user_id`)');
  });

  it('receipt を status より前に評価する（SET 左→右で status 代入後の値を参照しない）', () => {
    expect(Object.keys(set).indexOf('receipt')).toBeLessThan(Object.keys(set).indexOf('status'));
  });
});
