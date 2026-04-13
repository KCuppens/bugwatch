<?php

declare(strict_types=1);

namespace Bugwatch\Integrations\Symfony;

use Bugwatch\Bugwatch;
use Bugwatch\ScopeManager;
use Bugwatch\Types\RequestContext;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

final class EventSubscriber implements EventSubscriberInterface
{
    /**
     * @return array<string, array{0: string, 1: int}>
     */
    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::EXCEPTION => ['onKernelException', 0],
            KernelEvents::REQUEST => ['onKernelRequest', 256],
        ];
    }

    public function onKernelRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        $request = $event->getRequest();
        $scope = ScopeManager::getInstance();

        $requestContext = new RequestContext(
            url: $request->getUri(),
            method: $request->getMethod(),
            headers: array_map(
                fn (array $values): string => implode(', ', $values),
                $request->headers->all(),
            ),
            queryString: $request->query->all(),
        );

        $scope->setExtras(['request' => $requestContext->toArray()]);
    }

    public function onKernelException(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();

        Bugwatch::captureException($exception, [
            'extra' => [
                'symfony_event' => 'kernel.exception',
            ],
        ]);
    }
}
