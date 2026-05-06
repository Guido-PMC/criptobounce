from telegram.ext import Application, CommandHandler
from database import init_db, add_user, add_wallet, get_user_by_telegram_id
import sqlite3
import asyncio

# Inicialización del bot
async def start(update, context):
    """Registrar al usuario en la base de datos y mostrar mensaje de bienvenida."""
    telegram_id = update.effective_chat.id
    username = update.effective_chat.username
    add_user(telegram_id, username)
    await update.message.reply_text("¡Bienvenido al bot!")

async def add_wallet_command(update, context):
    """Comando para que el admin registre una wallet en una red específica."""
    telegram_id = update.effective_chat.id
    user = get_user_by_telegram_id(telegram_id)

    # Verificar si el usuario es admin
    if not user or user[3] != "admin":  # user[3] = rol del usuario
        await update.message.reply_text("No tienes permisos para usar este comando.")
        return

    # Validar argumentos
    if len(context.args) != 3:
        await update.message.reply_text("Uso: /addwallet <user_id> <network> <wallet_address>")
        return

    user_id, network, wallet_address = context.args
    add_wallet(user_id, network, wallet_address)
    await update.message.reply_text("Wallet registrada con éxito para el usuario.")

async def set_destination(update, context):
    """Permite al usuario configurar su wallet de destino en TRC20."""
    telegram_id = update.effective_chat.id
    user = get_user_by_telegram_id(telegram_id)

    # Verificar si el usuario está registrado
    if not user:
        await update.message.reply_text("Primero debes registrarte usando /start.")
        return

    # Validar argumentos
    if len(context.args) != 1:
        await update.message.reply_text("Uso: /setdestination <wallet_trc20>")
        return

    wallet_address = context.args[0]

    # Registrar la wallet de destino TRC20
    add_wallet(user[0], "TRC20", wallet_address)  # user[0] = ID del usuario
    await update.message.reply_text("Tu wallet de destino en TRC20 ha sido configurada con éxito.")

async def my_wallets(update, context):
    """Muestra al usuario sus wallets registradas y la comisión configurada."""
    telegram_id = update.effective_chat.id
    conn = sqlite3.connect('transactions.db')
    cursor = conn.cursor()

    # Obtener las wallets del usuario
    cursor.execute('''
    SELECT network, wallet_address FROM wallets
    JOIN users ON wallets.user_id = users.id
    WHERE users.telegram_id = ?
    ''', (telegram_id,))
    wallets = cursor.fetchall()

    # Obtener la comisión del usuario
    cursor.execute('SELECT commission FROM users WHERE telegram_id = ?', (telegram_id,))
    commission = cursor.fetchone()[0]

    conn.close()

    # Formatear la respuesta
    if not wallets:
        await update.message.reply_text("No tienes wallets registradas.")
        return

    response = "Tus wallets registradas:\n"
    for network, wallet_address in wallets:
        response += f"- {network}: {wallet_address}\n"
    response += f"\nComisión por transacción: {commission} USDT"

    await update.message.reply_text(response)

async def main():
    """Inicializar el bot y sus comandos."""
    init_db()

    application = Application.builder().token("7719695132:AAEUHPpVzyJM9Fb7nHA56II7UOxYi1Uzdxo").build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("addwallet", add_wallet_command))
    application.add_handler(CommandHandler("setdestination", set_destination))
    application.add_handler(CommandHandler("mywallets", my_wallets))

    # Iniciar el bot sin cerrar el bucle
    await application.initialize()
    await application.start()
    print("Bot corriendo...")
    await application.updater.start_polling()
    await asyncio.Event().wait()

if __name__ == "__main__":
    try:
        loop = asyncio.get_event_loop()
        if not loop.is_running():
            asyncio.run(main())
        else:
            loop.create_task(main())
    except RuntimeError as e:
        print(f"Error: {e}")
        asyncio.run(main())
