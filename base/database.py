import sqlite3

DB_FILE = "transactions.db"

def init_db():
    """Inicializa la base de datos y crea las tablas si no existen."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # Tabla de usuarios
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT UNIQUE,
        username TEXT,
        role TEXT DEFAULT 'user',
        commission REAL DEFAULT 0
    )
    ''')

    # Tabla de wallets
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        network TEXT, -- 'BSC', 'ERC20', 'OP', o 'TRC20'
        wallet_address TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')

    # Tabla de transacciones
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        network TEXT,
        wallet_address TEXT,
        amount REAL,
        fee REAL, -- Comisión cobrada
        destination_wallet TEXT, -- Wallet TRC20 de destino
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')

    conn.commit()
    conn.close()

def get_user_by_telegram_id(telegram_id):
    """Obtiene un usuario por su Telegram ID."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
    user = cursor.fetchone()
    conn.close()
    return user

def add_user(telegram_id, username, role='user', commission=0):
    """Agrega un usuario a la base de datos."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
    INSERT OR IGNORE INTO users (telegram_id, username, role, commission)
    VALUES (?, ?, ?, ?)
    ''', (telegram_id, username, role, commission))
    conn.commit()
    conn.close()

def add_wallet(user_id, network, wallet_address):
    """Agrega una wallet para un usuario."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO wallets (user_id, network, wallet_address)
    VALUES (?, ?, ?)
    ''', (user_id, network, wallet_address))
    conn.commit()
    conn.close()
