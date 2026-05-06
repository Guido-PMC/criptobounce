import time
from mexc_spot_v3 import *  # Cambiar a mexc_trade
import sqlite3

# Configuración de la base de datos
DB_FILE = "transactions.db"

def get_all_users():
    """Obtiene todos los usuarios registrados con sus API keys."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('SELECT id, telegram_id, commission, api_key, api_secret FROM users')
    users = cursor.fetchall()
    conn.close()
    return users

def get_trc20_wallet(user_id):
    """Obtiene la wallet TRC20 del usuario."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
    SELECT wallet_address FROM wallets
    WHERE user_id = ? AND network = 'TRC20'
    ''', (user_id,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None

def register_transaction(user_id, amount, fee, destination_wallet):
    """Registra una transacción en la base de datos."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO transactions (user_id, network, amount, fee, destination_wallet)
    VALUES (?, 'TRC20', ?, ?, ?)
    ''', (user_id, amount, fee, destination_wallet))
    conn.commit()
    conn.close()

def monitor_wallets():
    """Monitorea las cuentas de cada usuario y reenvía fondos automáticamente."""
    while True:
        try:
            # Obtener todos los usuarios y sus API keys
            users = get_all_users()

            for user in users:
                user_id, telegram_id, commission, api_key, api_secret = user
                print(f"Monitoreando la cuenta MEXC del usuario {telegram_id}...")


                # Inicializar la API de MEXC para este usuario con la clase mexc_trade
                user_trade = mexc_trade(api_key=api_key, api_secret=api_secret)
                user_wallet = mexc_wallet(api_key=api_key, api_secret=api_secret)


                # Obtener información de la cuenta del usuario
                account_info = user_trade.get_account_info()
                if not account_info or "balances" not in account_info:
                    print(f"Error al obtener la información de la cuenta para {telegram_id}.")
                    continue

                # Obtener la wallet TRC20 del usuario
                destination_wallet = get_trc20_wallet(user_id)
                if not destination_wallet:
                    print(f"El usuario {telegram_id} no tiene wallet TRC20 configurada.")
                    continue

                # Verificar los balances disponibles
                for balance in account_info["balances"]:
                    asset = balance["asset"]
                    available_balance = float(balance["free"])

                    # Procesar solo si hay saldo disponible
                    if available_balance > 0:
                        print(f"Usuario {telegram_id} tiene {available_balance} {asset} disponibles.")

                        # Calcular el monto neto después de la comisión
                        net_amount = available_balance - commission
                        if net_amount <= 0:
                            print(f"El saldo disponible no es suficiente para cubrir la comisión de {commission}.")
                            continue

                        # Reenviar fondos a la wallet TRC20
                        print(f"Reenviando {net_amount} {asset} a {destination_wallet}...")
                        response = user_wallet.post_withdraw({
                            "coin": asset,
                            "network": "Tron(TRC20)",
                            "address": destination_wallet,
                            "amount": str(net_amount),
                        })

                        if response.get("msg") == "OK":
                            print(f"Transferencia de {net_amount} {asset} realizada con éxito.")
                            register_transaction(user_id, available_balance, commission, destination_wallet)
                        else:
                            print(f"Error al reenviar fondos para {telegram_id}: {response}")

        except Exception as e:
            print(f"Error durante el monitoreo: {e}")

        # Esperar antes de la siguiente iteración
        time.sleep(60)

if __name__ == "__main__":
    print("Iniciando el monitoreo de cuentas MEXC...")
    monitor_wallets()
