#!/usr/bin/env python
"""
Full integration test for Bugwatch Django SDK.
Tests all error scenarios using Django's test client.
"""
import os
os.environ['DJANGO_SETTINGS_MODULE'] = 'testsite.settings'

import django
django.setup()

from django.test import Client

def main():
    client = Client()

    print('=' * 70)
    print('BUGWATCH DJANGO SDK INTEGRATION TEST')
    print('=' * 70)
    print()

    tests = [
        ('/', 200, 'Home page (no error)'),
        ('/success', 200, 'Success endpoint'),
        ('/error/value', None, 'ValueError exception'),
        ('/error/key', None, 'KeyError exception'),
        ('/error/zero', None, 'ZeroDivisionError'),
        ('/error/deep', None, 'Deep stacktrace (10 levels)'),
        ('/error/with-user', None, 'Error with user context'),
        ('/error/with-tags', None, 'Error with custom tags'),
        ('/error/with-extra', None, 'Error with extra data'),
        ('/capture/exception', 200, 'Manual capture_exception'),
        ('/capture/message', 200, 'Manual capture_message'),
    ]

    for path, expected_status, desc in tests:
        print(f'>>> Testing: {desc}')
        print(f'    Path: {path}')
        try:
            response = client.get(path)
            status = response.status_code
            if expected_status and status != expected_status:
                print(f'    UNEXPECTED STATUS: {status} (expected {expected_status})')
            else:
                print(f'    Status: {status}')
        except Exception as e:
            print(f'    Exception raised: {type(e).__name__}')
        print()

    print('=' * 70)
    print('TEST COMPLETE - Check output above for captured events')
    print('=' * 70)

if __name__ == '__main__':
    main()
