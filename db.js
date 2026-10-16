import mysql from 'mysql2/promise';
import config from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  charset: 'utf8mb4',
  dateStrings: true,
});

export async function query(sql, values = []) {
  const [rows] = await pool.execute(sql, values);
  return rows;
}

export async function queryOne(sql, values = []) {
  const rows = await query(sql, values);
  return rows[0] ?? null;
}

export async function transaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const run = async (sql, values = []) => (await conn.execute(sql, values))[0];
    const result = await work(run);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const tables = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
  )`,

  `CREATE TABLE IF NOT EXISTS projects (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100) NOT NULL,
    description TEXT         NOT NULL,
    owner_id    INT UNSIGNED NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS project_members (
    project_id INT UNSIGNED NOT NULL,
    user_id    INT UNSIGNED NOT NULL,
    role       ENUM('owner', 'member', 'viewer') NOT NULL,
    joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users (id)    ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS invitations (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id   INT UNSIGNED NOT NULL,
    invited_by   INT UNSIGNED NOT NULL,
    invitee_id   INT UNSIGNED NOT NULL,
    role         ENUM('member', 'viewer') NOT NULL DEFAULT 'member',
    status       ENUM('pending', 'accepted', 'declined', 'cancelled') NOT NULL DEFAULT 'pending',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users (id)    ON DELETE CASCADE,
    FOREIGN KEY (invitee_id) REFERENCES users (id)    ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    created_by   INT UNSIGNED NOT NULL,
    project_id   INT UNSIGNED NULL,
    assignee_id  INT UNSIGNED NULL,
    title        VARCHAR(200) NOT NULL,
    description  TEXT         NOT NULL,
    due_date     DATE         NULL,
    priority     ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    completed    TINYINT(1)   NOT NULL DEFAULT 0,
    completed_at DATETIME     NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (created_by)  REFERENCES users (id)    ON DELETE CASCADE,
    FOREIGN KEY (project_id)  REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (assignee_id) REFERENCES users (id)    ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    expires    INT UNSIGNED NOT NULL,
    data       MEDIUMTEXT   COLLATE utf8mb4_bin,
    PRIMARY KEY (session_id)
  )`,
];

export async function createTables() {
  for (const sql of tables) {
    await pool.query(sql + ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  }
}
