<?php

declare(strict_types=1);

namespace Bugwatch\Types;

final class StackFrame
{
    public function __construct(
        public readonly ?string $filename = null,
        public readonly ?string $function = null,
        public readonly ?int $lineno = null,
        public readonly ?int $colno = null,
        public readonly ?string $absPath = null,
        public readonly bool $inApp = true,
        public readonly ?string $contextLine = null,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'filename' => $this->filename,
            'function' => $this->function,
            'lineno' => $this->lineno,
            'colno' => $this->colno,
            'abs_path' => $this->absPath,
            'in_app' => $this->inApp,
            'context_line' => $this->contextLine,
        ], fn (mixed $value): bool => $value !== null);
    }
}
