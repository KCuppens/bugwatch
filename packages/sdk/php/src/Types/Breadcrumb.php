<?php

declare(strict_types=1);

namespace Bugwatch\Types;

final class Breadcrumb
{
    /**
     * @param array<string, mixed> $data
     */
    public function __construct(
        public readonly float $timestamp,
        public readonly string $type = 'default',
        public readonly string $category = '',
        public readonly string $message = '',
        public readonly array $data = [],
        public readonly Level $level = Level::Info,
    ) {}

    /**
     * @param array<string, mixed> $data
     */
    public static function create(
        string $category,
        string $message = '',
        Level $level = Level::Info,
        string $type = 'default',
        array $data = [],
    ): self {
        return new self(
            timestamp: microtime(true),
            type: $type,
            category: $category,
            message: $message,
            data: $data,
            level: $level,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'timestamp' => $this->timestamp,
            'type' => $this->type,
            'category' => $this->category,
            'message' => $this->message,
            'data' => $this->data ?: null,
            'level' => $this->level->value,
        ], fn (mixed $value): bool => $value !== null);
    }
}
