<?php

declare(strict_types=1);

namespace Bugwatch\Types;

final class RequestContext
{
    /**
     * @param array<string, string> $headers
     * @param array<string, mixed> $queryString
     * @param array<string, mixed> $data
     */
    public function __construct(
        public readonly ?string $url = null,
        public readonly ?string $method = null,
        public readonly array $headers = [],
        public readonly array $queryString = [],
        public readonly array $data = [],
    ) {
    }

    public static function fromGlobals(): self
    {
        $url = '';
        if (isset($_SERVER['REQUEST_SCHEME'], $_SERVER['HTTP_HOST'], $_SERVER['REQUEST_URI'])) {
            $url = $_SERVER['REQUEST_SCHEME'] . '://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];
        }

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headerName = str_replace('_', '-', strtolower(substr($key, 5)));
                $headers[$headerName] = (string) $value;
            }
        }

        return new self(
            url: $url ?: null,
            method: $_SERVER['REQUEST_METHOD'] ?? null,
            headers: $headers,
            queryString: $_GET,
            data: $_POST,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'url' => $this->url,
            'method' => $this->method,
            'headers' => $this->headers ?: null,
            'query_string' => $this->queryString ?: null,
            'data' => $this->data ?: null,
        ], fn (mixed $value): bool => $value !== null);
    }
}
