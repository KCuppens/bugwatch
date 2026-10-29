<?php

declare(strict_types=1);

namespace Bugwatch\Transport;

use Bugwatch\Options;
use Bugwatch\Types\ErrorEvent;

final class HttpTransport implements TransportInterface
{
    public function __construct(
        private readonly Options $options,
    ) {
    }

    public function send(ErrorEvent $event): bool
    {
        $url = rtrim($this->options->serverUrl, '/') . '/api/v1/events';
        $payload = json_encode($event->toArray(), JSON_THROW_ON_ERROR);

        $ch = curl_init($url);

        if ($ch === false) {
            if ($this->options->debug) {
                error_log('[Bugwatch] Failed to initialize cURL');
            }

            return false;
        }

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->options->apiKey,
                'User-Agent: bugwatch-php/0.1.0',
            ],
        ]);

        $response = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError !== '') {
            if ($this->options->debug) {
                error_log('[Bugwatch] Transport error: ' . $curlError);
            }

            return false;
        }

        if ($statusCode < 200 || $statusCode >= 300) {
            if ($this->options->debug) {
                error_log(sprintf(
                    '[Bugwatch] API returned status %d: %s',
                    $statusCode,
                    is_string($response) ? $response : '',
                ));
            }

            return false;
        }

        return true;
    }
}
