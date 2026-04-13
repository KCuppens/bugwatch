"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FadeUp, StaggerContainer, StaggerItem } from "./motion";

const faqs = [
  {
    question: "What's the catch with unlimited errors?",
    answer:
      "No catch. We charge per seat, not per event volume. We believe error tracking should help you fix bugs faster, not punish you during incidents. Flat pricing means you can scale without worrying about your bill.",
  },
  {
    question: "Can I migrate from Sentry?",
    answer:
      "Yes! Our SDK is designed to be a drop-in replacement. In most cases, you just need to swap the import and update your API key. We're also working on a migration tool that imports your existing project settings and alert rules.",
  },
  {
    question: "Is the self-hosted version full-featured?",
    answer:
      "Yes, the self-hosted version includes all core features: unlimited error tracking, issue management, alerts, uptime monitoring, and server monitoring. It's MIT licensed with no artificial limitations.",
  },
  {
    question: "What about data retention?",
    answer:
      "Data retention varies by plan: 7 days on Free, 90 days on Pro, and 365 days on Team. Self-hosted users can configure unlimited retention. All plans include unlimited error ingestion\u2014retention only affects how long we store the event data.",
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="container mx-auto px-4 py-28">
      <FadeUp>
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display text-display-md md:text-display-lg mb-4">
            Frequently asked{" "}
            <span className="text-accent">questions</span>
          </h2>
          <p className="text-body-lg text-muted-foreground">
            Everything you need to know about BugWatch.
          </p>
        </div>
      </FadeUp>

      <StaggerContainer className="max-w-2xl mx-auto">
        {faqs.map((faq, index) => {
          const isOpen = openIndex === index;
          const panelId = `faq-panel-${index}`;
          const buttonId = `faq-button-${index}`;
          return (
            <StaggerItem key={index} className="mb-4">
              <button
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className={`w-full p-5 rounded-xl glass-card text-left transition-colors ${
                  isOpen ? "border-accent/30" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium pr-8">{faq.question}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="grid transition-all duration-300 ease-in-out"
                style={{
                  gridTemplateRows: isOpen ? "1fr" : "0fr",
                }}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-muted-foreground text-sm leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              </div>
            </StaggerItem>
          );
        })}
      </StaggerContainer>
    </section>
  );
}
