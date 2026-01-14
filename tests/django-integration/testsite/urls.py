"""
URL configuration for testsite project.
"""
from django.urls import path
from testapp import views

urlpatterns = [
    # Home
    path('', views.index, name='index'),

    # Success endpoints
    path('success', views.success, name='success'),
    path('json', views.json_response, name='json'),

    # Error triggers
    path('error/value', views.error_value, name='error_value'),
    path('error/key', views.error_key, name='error_key'),
    path('error/zero', views.error_zero, name='error_zero'),
    path('error/type', views.error_type, name='error_type'),
    path('error/attribute', views.error_attribute, name='error_attribute'),
    path('error/nested', views.error_nested, name='error_nested'),
    path('error/deep', views.error_deep, name='error_deep'),

    # Context tests
    path('error/with-user', views.error_with_user, name='error_with_user'),
    path('error/with-tags', views.error_with_tags, name='error_with_tags'),
    path('error/with-breadcrumbs', views.error_with_breadcrumbs, name='error_with_breadcrumbs'),
    path('error/with-extra', views.error_with_extra, name='error_with_extra'),

    # Manual capture
    path('capture/exception', views.capture_exception_manual, name='capture_exception'),
    path('capture/message', views.capture_message_manual, name='capture_message'),

    # Logging
    path('log/error', views.log_error, name='log_error'),
    path('log/exception', views.log_exception, name='log_exception'),

    # Thread/Async
    path('error/thread', views.error_in_thread, name='error_thread'),
    path('error/async', views.error_in_async, name='error_async'),
]
