const mysql = require('mysql');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'myapp'
});

async function findUser(username, password) {
  // SQL injection — string concatenation instead of parameterized query
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  return new Promise((resolve, reject) => {
    connection.query(query, (err, results) => {
      if (err) reject(err);
      resolve(results?.[0]);
    });
  });
}

async function getUser(id) {
  // Also SQL injection vulnerable
  const query = `SELECT * FROM users WHERE id = ${id}`;
  return new Promise((resolve, reject) => {
    connection.query(query, (err, results) => {
      if (err) reject(err);
      resolve(results?.[0]);
    });
  });
}

async function createUser(data) {
  // No password hashing, stores plaintext
  const query = `INSERT INTO users SET username = '${data.username}', password = '${data.password}', email = '${data.email}'`;
  return new Promise((resolve, reject) => {
    connection.query(query, (err, results) => {
      if (err) reject(err);
      resolve({ id: results?.insertId });
    });
  });
}

async function search(term) {
  // XSS + SQL injection
  const query = `SELECT * FROM products WHERE name LIKE '%${term}%'`;
  return new Promise((resolve, reject) => {
    connection.query(query, (err, results) => {
      if (err) reject(err);
      resolve(results);
    });
  });
}

async function deleteUser(id) {
  const query = `DELETE FROM users WHERE id = ${id}`;
  return new Promise((resolve, reject) => {
    connection.query(query, (err, results) => {
      if (err) reject(err);
      resolve(results);
    });
  });
}

module.exports = { findUser, getUser, createUser, search, deleteUser };
