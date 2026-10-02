#!/usr/bin/env python3
"""À lancer UNE fois sur ton Mac : se connecte à Garmin Connect (code MFA géré)
et affiche les 2 valeurs à coller dans les secrets GitHub.

    uv run --python 3.12 --with garminconnect garmin_setup.py

Ton mot de passe sert uniquement à cette connexion. Il n'est ni affiché ni enregistré.
"""
import getpass
import secrets
import sys

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("Lance plutôt :  uv run --python 3.12 --with garminconnect garmin_setup.py")

email = input("E-mail Garmin Connect : ").strip()
password = getpass.getpass("Mot de passe (rien ne s'affiche, c'est normal) : ")

api = Garmin(email, password, prompt_mfa=lambda: input("Code de vérification reçu (MFA) : ").strip())
try:
    api.login()
except Exception as e:
    sys.exit(f"\nConnexion refusée : {e}\nVérifie tes identifiants et réessaie dans quelques minutes.")

name = ""
try:
    name = api.get_full_name() or ""
except Exception:
    pass

print(f"\nConnecté{(' : ' + name) if name else ''}. Crée ces 2 secrets dans GitHub :\n")
print("──── Nom : GARMIN_TOKENS ──── valeur (une seule ligne) :")
print(api.client.dumps())
print("\n──── Nom : GARMIN_KEY ──── valeur :")
print(secrets.token_urlsafe(32))
print("\nGarde ces valeurs pour toi : elles donnent accès à ton compte Garmin.")
