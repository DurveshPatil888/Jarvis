import speech_recognition as sr
import pyaudio
import requests

def main():
    recognizer = sr.Recognizer()
    recognizer.pause_threshold = 2.0 
    mic = sr.Microphone()
    
    print("🎙️ Calibrating microphone... Please wait.")
    with mic as source:
        recognizer.adjust_for_ambient_noise(source, duration=1.5)
    
    print("✅ JARVIS is online! Waiting STRICTLY for the wake word ('Jarvis')...")
    
    while True:
        try:
            with mic as source:
                audio = recognizer.listen(source, timeout=None, phrase_time_limit=None)
            
            text = recognizer.recognize_google(audio).lower()
            
            # 🚀 STRICT WAKE WORD LOGIC
            if "jarvis" in text:
                # "Jarvis" ke aage ka jo bhi bola hai, sirf wahi extract karega
                parts = text.split("jarvis", 1)
                command = parts[1].strip() # Piche ka fालतू text hata dega
                
                # Agar sirf "Hey Jarvis" bola aur aage kuch nahi, toh hello bhejenge
                if not command:
                    command = "hello"
                    
                print(f"🚨 Wake Word Triggered! Action: '{command}'")
                
                payload = {"command": command}
                try:
                    requests.post("http://localhost:4000/api/voice", json=payload, timeout=5)
                except requests.exceptions.RequestException as e:
                    print(f"⚠️ Node server is DOWN! ({e})")
            else:
                # Agar Jarvis nahi bola, toh chupchap ignore karega (Node ko nahi bhejega)
                print(f"🤫 Ignored (No wake word): {text}")
                
        except sr.WaitTimeoutError:
            pass
        except sr.UnknownValueError:
            pass
        except Exception as e:
            pass

if __name__ == "__main__":
    main()