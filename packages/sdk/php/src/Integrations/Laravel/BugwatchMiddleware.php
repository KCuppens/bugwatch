<?php

declare(strict_types=1);

namespace Bugwatch\Integrations\Laravel;

use Bugwatch\ScopeManager;
use Bugwatch\Types\RequestContext;
use Bugwatch\Types\UserContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class BugwatchMiddleware
{
    /**
     * @param Closure(Request): Response $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $scope = ScopeManager::getInstance();

        // Set request context
        $requestContext = new RequestContext(
            url: $request->fullUrl(),
            method: $request->method(),
            headers: $this->sanitizeHeaders($request->headers->all()),
            queryString: $request->query->all(),
            data: $request->except(['password', 'password_confirmation', 'token', 'secret']),
        );

        $scope->setExtras(['request' => $requestContext->toArray()]);

        // Set user context if authenticated
        $user = $request->user();
        if ($user !== null) {
            $scope->setUser(new UserContext(
                id: (string) $user->getAuthIdentifier(),
                email: $user->email ?? null,
                username: $user->name ?? null,
                ipAddress: $request->ip(),
            ));
        } else {
            $scope->setUser(new UserContext(
                ipAddress: $request->ip(),
            ));
        }

        return $next($request);
    }

    /**
     * @param array<string, mixed> $headers
     * @return array<string, string>
     */
    private function sanitizeHeaders(array $headers): array
    {
        $sanitized = [];
        $sensitiveHeaders = ['authorization', 'cookie', 'x-csrf-token', 'x-xsrf-token'];

        foreach ($headers as $key => $values) {
            $key = strtolower((string) $key);

            if (in_array($key, $sensitiveHeaders, true)) {
                $sanitized[$key] = '[Filtered]';
            } else {
                $sanitized[$key] = is_array($values) ? implode(', ', $values) : (string) $values;
            }
        }

        return $sanitized;
    }
}
