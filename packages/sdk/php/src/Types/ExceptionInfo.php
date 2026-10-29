<?php

declare(strict_types=1);

namespace Bugwatch\Types;

final class ExceptionInfo
{
    /**
     * @param StackFrame[] $stacktrace
     */
    public function __construct(
        public readonly string $type,
        public readonly string $value,
        public readonly array $stacktrace = [],
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'type' => $this->type,
            'value' => $this->value,
            'stacktrace' => array_map(
                fn (StackFrame $frame): array => $frame->toArray(),
                $this->stacktrace,
            ),
        ];
    }
}
