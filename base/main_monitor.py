import asyncio
import time
import sqlite3
from telegram.ext import Application, CommandHandler
from mexc_spot_v3 import mexc_trade, mexc_wallet
from database import init_db, add_user, add_wallet, get_user_by_telegram_id
import time
from dotenv import load_dotenv
import os

# Cargar variables de entorno desde el archivo .env
load_dotenv()

# Obtener el token de Telegram desde la variable de entorno
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TOKEN:
    raise ValueError("El token de Telegram no está configurado. Asegúrate de definir TELEGRAM_BOT_TOKEN en .env.")
    
DB_FILE = "transactions.db"

# Inicializar la base de datos
init_db()

# Funciones del bot
ADMIN_TELEGRAM_ID = 5505157290  # Reemplaza con el Telegram ID del admin

async def start(update, context):
    """Registrar al usuario y notificar al administrador."""
    telegram_id = update.effective_chat.id
    username = update.effective_chat.username

    # Registrar al usuario con estado 'pending'
    add_user(telegram_id, username, status='pending')  # Actualiza la función add_user para manejar el estado

    # Mensaje de bienvenida para el usuario
    welcome_message = (
        f"¡Hola {username or 'usuario'}! 👋\n\n"
        "Tu cuenta está en proceso de aprobación. Te notificaremos cuando esté lista.\n\n"
        "Mientras tanto, si tienes dudas, no dudes en contactarnos. 🚀"
    )
    await update.message.reply_text(welcome_message)

    # Notificar al administrador
    admin_message = (
        f"⚠️ Nuevo registro detectado:\n\n"
        f"🆔 ID: {telegram_id}\n"
        f"👤 Usuario: {username or 'Desconocido'}\n\n"
        f"Usa /approve {telegram_id} para aprobar este usuario."
    )
    await context.bot.send_message(chat_id=ADMIN_TELEGRAM_ID, text=admin_message)

async def approve(update, context):
    """Aprobar a un usuario registrado."""
    telegram_id = update.effective_chat.id
    username = update.effective_chat.username

    # Verificar si el usuario que ejecuta el comando es el admin
    if telegram_id != ADMIN_TELEGRAM_ID:
        await update.message.reply_text("No tienes permisos para usar este comando.")
        return

    # Validar argumentos
    if len(context.args) != 1:
        await update.message.reply_text("Uso: /approve <telegram_id>")
        return

    user_telegram_id = context.args[0]

    # Actualizar el estado del usuario a 'approved' en la base de datos
    conn = sqlite3.connect('transactions.db')
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET status = ? WHERE telegram_id = ?', ('approved', user_telegram_id))
    conn.commit()
    conn.close()

    # Notificar al admin
    await update.message.reply_text(f"Usuario {user_telegram_id} aprobado con éxito.")

    # Notificar al usuario aprobado
    await context.bot.send_message(
        chat_id=user_telegram_id,
        text="🎉 ¡Tu cuenta ha sido aprobada! Ya puedes usar el bot. 🚀"
    )

async def add_wallet_command(update, context):
    """Comando para que el admin registre una wallet en una red específica."""
    telegram_id = update.effective_chat.id
    user = get_user_by_telegram_id(telegram_id)

    if not user or user[3] != "admin":
        await update.message.reply_text("No tienes permisos para usar este comando.")
        return

    if len(context.args) != 3:
        await update.message.reply_text("Uso: /addwallet <user_id> <network> <wallet_address>")
        return

    user_id, network, wallet_address = context.args
    add_wallet(user_id, network, wallet_address)
    await update.message.reply_text("Wallet registrada con éxito para el usuario.")

async def add_api_key(update, context):
    """Permite al admin agregar las API keys de un cliente."""
    telegram_id = update.effective_chat.id

    # Verificar si el usuario es admin
    if telegram_id != ADMIN_TELEGRAM_ID:
        await update.message.reply_text("No tienes permisos para usar este comando.")
        return

    # Validar argumentos
    if len(context.args) != 3:
        await update.message.reply_text("Uso: /addapikey <user_telegram_id> <api_key> <api_secret>")
        return

    user_telegram_id, api_key, api_secret = context.args

    # Verificar si el usuario existe en la base de datos
    user = get_user_by_telegram_id(user_telegram_id)
    if not user:
        await update.message.reply_text(f"No se encontró ningún usuario con ID {user_telegram_id}.")
        return

    # Actualizar las API keys en la base de datos
    conn = sqlite3.connect('transactions.db')
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE users SET api_key = ?, api_secret = ? WHERE telegram_id = ?
    ''', (api_key, api_secret, user_telegram_id))
    conn.commit()
    conn.close()

    await update.message.reply_text(f"API keys agregadas exitosamente para el usuario {user_telegram_id}.")

async def set_destination(update, context):
    """Configurar wallet TRC20 si el usuario está aprobado."""
    telegram_id = update.effective_chat.id
    user = get_user_by_telegram_id(telegram_id)

    # Verificar si el usuario está registrado y aprobado
    if not user:
        await update.message.reply_text("Primero debes registrarte usando /start.")
        return
    if user[4] != "approved":  # user[4] = status
        await update.message.reply_text("Tu cuenta aún no ha sido aprobada. Por favor, espera.")
        return

    # Continuar con la lógica actual
    if len(context.args) != 1:
        await update.message.reply_text("Uso: /setdestination <wallet_trc20>")
        return

    wallet_address = context.args[0]
    add_wallet(user[0], "TRC20", wallet_address)  # user[0] = ID del usuario
    await update.message.reply_text("Tu wallet de destino en TRC20 ha sido configurada con éxito.")

    wallet_address = context.args[0]
    add_wallet(user[0], "TRC20", wallet_address)
    await update.message.reply_text("Tu wallet de destino en TRC20 ha sido configurada con éxito.")

async def my_wallets(update, context):
    """Muestra al usuario sus wallets registradas y la comisión configurada."""
    telegram_id = update.effective_chat.id
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    try:
        cursor.execute('''
        SELECT network, wallet_address FROM wallets
        JOIN users ON wallets.user_id = users.id
        WHERE users.telegram_id = ?
        ''', (telegram_id,))
        wallets = cursor.fetchall()

        cursor.execute('SELECT commission FROM users WHERE telegram_id = ?', (telegram_id,))
        commission = cursor.fetchone()[0]
    except Exception as e:
        await update.message.reply_text("Error al consultar tus wallets.")
        print(f"Error de SQLite: {e}")
        return
    finally:
        conn.close()

    if not wallets:
        await update.message.reply_text("No tienes wallets registradas.")
        return

    response = "Tus wallets registradas:\n"
    for network, wallet_address in wallets:
        response += f"- {network}: {wallet_address}\n"
    response += f"\nComisión por transacción: {commission} USDT"

    await update.message.reply_text(response)

# Funciones de monitoreo
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

async def notify_user(application, telegram_id, message):
    """Envía una notificación al usuario de Telegram."""
    try:
        await application.bot.send_message(chat_id=telegram_id, text=message)
    except Exception as e:
        print(f"Error al enviar notificación: {e}")

en_liberacion = {}  # Diccionario global para controlar los depósitos en proceso de liberación

def clean_en_liberacion():
    """Limpia entradas obsoletas del diccionario en_liberacion."""
    current_time = time.time()
    keys_to_remove = [key for key, value in en_liberacion.items() if current_time - value["timestamp"] > 86400]  # 24 horas
    for key in keys_to_remove:
        del en_liberacion[key]

async def monitor_wallets(application):
    while True:
        try:
            users = get_all_users()

            for user in users:
                user_id, telegram_id, commission, api_key, api_secret = user
                print(f"Monitoreando la cuenta del usuario {telegram_id}...")

                trade = mexc_trade(api_key=api_key, api_secret=api_secret)
                wallet = mexc_wallet(api_key=api_key, api_secret=api_secret)

                try:
                    account_info = trade.get_account_info()
                    if not account_info or "balances" not in account_info:
                        print(f"Error al obtener la información de la cuenta para {telegram_id}.")
                        continue
                except Exception as e:
                    print(f"Error al obtener balances de MEXC para {telegram_id}: {e}")
                    continue

                destination_wallet = get_trc20_wallet(user_id)
                if not destination_wallet:
                    print(f"El usuario {telegram_id} no tiene wallet TRC20 configurada.")
                    continue

                for balance in account_info["balances"]:
                    asset = balance["asset"]
                    free_balance = float(balance["free"])

                    if free_balance > 0:
                        try:
                            print(f"Saldo disponible detectado: {free_balance} {asset} para {telegram_id}.")
                            response = wallet.post_withdraw({
                                "coin": asset,
                                "network": "Tron(TRC20)",
                                "address": destination_wallet,
                                "amount": str(free_balance - commission),
                            })

                            print(response)

                            # Caso 1: Retiro exitoso
                            if response and "id" in response:
                                print(f"Retiro completado: {free_balance - commission} {asset} enviado a {destination_wallet}.")
                                await notify_user(application, telegram_id, f"Retiro completado: {free_balance - commission} {asset} enviado a tu wallet TRC20.")
                                register_transaction(user_id, free_balance, commission, destination_wallet)
                                en_liberacion.pop(telegram_id, None)  # Eliminar entrada del diccionario

                            # Caso 2: Fondos no completamente liberados
                            elif "Some pre-crediting assets are temporarily unavailable" in response.get("msg", ""):
                                if telegram_id not in en_liberacion:  # Enviar mensaje solo si no se notificó antes
                                    print(f"Depósito de {free_balance} {asset} para {telegram_id} aún en proceso de acreditación.")
                                    await notify_user(application, telegram_id, f"Tu depósito de {free_balance} {asset} aún está en proceso de liberación. Seguiremos monitoreando y lo procesaremos automáticamente.")
                                    en_liberacion[telegram_id] = {"timestamp": time.time()}  # Registrar timestamp de la notificación

                            # Caso 3: Otros errores
                            else:
                                print(f"Error al realizar el retiro para {telegram_id}: {response}")
                                await notify_user(application, telegram_id, "Hubo un problema al intentar procesar tu retiro. Por favor, contáctanos para más detalles.")

                        except Exception as e:
                            print(f"Error al intentar procesar el retiro para {telegram_id}: {e}")
                            await notify_user(application, telegram_id, "Ocurrió un error al intentar procesar tu retiro. Seguimos monitoreando.")

            # Limpieza periódica de en_liberacion
            clean_en_liberacion()

        except Exception as e:
            print(f"Error en el monitoreo: {e}")

        # Pausar antes del siguiente ciclo
        await asyncio.sleep(60)

# Inicialización del bot
async def main():
    application = Application.builder().token(TOKEN).build()

    # Agregar manejadores de comandos al bot
    application.add_handler(CommandHandler("start", start))               # Comando para iniciar el bot
    application.add_handler(CommandHandler("addwallet", add_wallet_command)) # Comando para que admin agregue wallets
    application.add_handler(CommandHandler("setdestination", set_destination)) # Comando para que el usuario configure su wallet TRC20
    application.add_handler(CommandHandler("mywallets", my_wallets))         # Comando para mostrar wallets registradas
    application.add_handler(CommandHandler("addapikey", add_api_key))        # Comando para que admin agregue API keys

    asyncio.create_task(monitor_wallets(application))

    await application.initialize()
    await application.start()
    print("Bot y monitoreo corriendo...")
    await application.updater.start_polling()
    await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
