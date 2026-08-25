import time
import logging
import threading
import requests
import speech_recognition as sr

# ---------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------
WAKE_WORDS = [
    "hey jarvis", 
    "hi jarvis", 
    "hello jarvis", 
    "ok jarvis", 
    "jarvis"
]
ACTIVE_WINDOW = 15
SERVER_URL = "http://localhost:4000/api/voice"
REQUEST_TIMEOUT = 5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("jarvis")

recognizer = sr.Recognizer()
mic = sr.Microphone()
last_wake_time = 0.0

def send_command_async(command: str) -> None:
    def _send():
        try:
            resp = requests.post(SERVER_URL, json={"command": command}, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            log.info(f"Server responded OK: {resp.status_code}")
        except requests.exceptions.RequestException as e:
            log.error(f"Failed to reach backend: {e}")
    threading.Thread(target=_send, daemon=True).start()

def extract_wake_word(text: str):
    for w in WAKE_WORDS:
        if w in text:
            return w
    return None

def main():
    global last_wake_time

    log.info("Calibrating for ambient noise... stay quiet for a moment.")
    with mic as source:
        recognizer.adjust_for_ambient_noise(source, duration=1)
        
    if recognizer.energy_threshold > 300:
        log.info(f"Lowering mic threshold from {int(recognizer.energy_threshold)} to 300")
        recognizer.energy_threshold = 300

    log.info(f"✅ JARVIS is online! Waiting for the wake word...")

    while True:
        try:
            with mic as source:
                audio = recognizer.listen(source, timeout=None, phrase_time_limit=5)
            try:
                text = recognizer.recognize_google(audio).lower()
            except sr.UnknownValueError:
                continue
            except sr.RequestError as e:
                log.error(f"Speech recognition service unavailable: {e}")
                continue

            log.info(f"🎤 Heard: {text}")
            wake_word = extract_wake_word(text)
            is_active_conversation = (time.time() - last_wake_time) <= ACTIVE_WINDOW

            if wake_word or is_active_conversation:
                last_wake_time = time.time()
                clean_command = text.replace(wake_word, "", 1).strip() if wake_word else text.strip()
                if not clean_command:
                    log.info("🚨 Wake word triggered! Waiting for command...")
                    continue
                log.info(f"🚀 Sending command to server: '{clean_command}'")
                send_command_async(clean_command)
            else:
                log.info(f"🤫 Ignored (no wake word): {text}")

        except KeyboardInterrupt:
            log.info("Shutting down JARVIS listener. Bye!")
            break
        except sr.WaitTimeoutError:
            continue
        except Exception as e:
            log.exception(f"Unexpected error in listener loop: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()