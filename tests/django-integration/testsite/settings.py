"""
Django settings for testsite project.
Bugwatch Django Integration Test
"""

import os
import sys
from pathlib import Path

# Add the SDK to the path
SDK_PATH = Path(__file__).resolve().parent.parent.parent.parent / 'packages' / 'sdk' / 'python'
sys.path.insert(0, str(SDK_PATH))

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = 'django-insecure-test-key-for-bugwatch-integration-testing'

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

ALLOWED_HOSTS = ['*']

# Application definition
INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'testapp',
]

MIDDLEWARE = [
    'bugwatch.integrations.django.BugwatchMiddleware',  # Bugwatch FIRST
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'testsite.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'testsite.wsgi.application'

# Database - using SQLite for simplicity
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = []

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# =============================================================================
# BUGWATCH CONFIGURATION
# =============================================================================
BUGWATCH = {
    'api_key': os.environ.get('BUGWATCH_API_KEY', 'bw_live_88ce35bd819d4c54875d002fdc0ae8c1'),
    'endpoint': 'http://127.0.0.1:3000',  # Local Bugwatch server
    'environment': 'development',
    'release': '1.0.0-test',
    'debug': True,  # Shows [Bugwatch] logs in console
}

# =============================================================================
# LOGGING CONFIGURATION (with Bugwatch handler)
# =============================================================================
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
        },
        'bugwatch': {
            'class': 'bugwatch.integrations.logging.BugwatchHandler',
            'level': 'ERROR',
        },
    },
    'loggers': {
        'testapp': {
            'handlers': ['console', 'bugwatch'],
            'level': 'DEBUG',
        },
    },
}
