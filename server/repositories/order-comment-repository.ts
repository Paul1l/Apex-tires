import type { DatabaseExecutor } from "../types/common";

/**
 * Internal staff comments on orders (migration 012). Read only by the admin
 * order API; customer endpoints never query this table.
 */

export interface OrderCommentRow {
  id: string;
  order_id: string;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: Date | string;
}

export class OrderCommentRepository {
  async create(
    database: DatabaseExecutor,
    comment: { orderId: string; authorUserId: string; body: string },
  ): Promise<OrderCommentRow> {
    const result = await database.query<OrderCommentRow>(
      `WITH inserted AS (
         INSERT INTO order_comments (order_id, author_user_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, order_id, author_user_id, body, created_at
       )
       SELECT inserted.id, inserted.order_id, inserted.author_user_id,
              users.name AS author_name, inserted.body, inserted.created_at
       FROM inserted
       LEFT JOIN users ON users.id = inserted.author_user_id`,
      [comment.orderId, comment.authorUserId, comment.body],
    );
    return result.rows[0];
  }

  /** Newest first; bounded so one order cannot make the page unbounded. */
  async listForOrder(
    database: DatabaseExecutor,
    orderId: string,
    limit = 200,
  ): Promise<OrderCommentRow[]> {
    const result = await database.query<OrderCommentRow>(
      `SELECT order_comments.id, order_comments.order_id,
              order_comments.author_user_id, users.name AS author_name,
              order_comments.body, order_comments.created_at
       FROM order_comments
       LEFT JOIN users ON users.id = order_comments.author_user_id
       WHERE order_comments.order_id = $1
       ORDER BY order_comments.created_at DESC, order_comments.id DESC
       LIMIT $2`,
      [orderId, limit],
    );
    return result.rows;
  }
}
