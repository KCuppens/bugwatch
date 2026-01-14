"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "What's the catch with unlimited errors?",
    answer:
      "No catch. We make money from subscription tiers and AI fix credits, not from your error volume. We believe error tracking should help you fix bugs faster, not punish you during incidents. Flat pricing means you can scale without worrying about your bill.",
  },
  {
    question: "How does AI fix generation work?",
    answer:
      "When you click 'AI Fix' on an issue, we send the error details, stack trace, and code context to Claude. It analyzes the root cause and suggests a code fix with an explanation. You review the suggestion and can apply it directly or use it as a starting point. Each AI fix costs credits (included in paid plans or available as pay-as-you-go).",
  },
  {
    question: "Can I migrate from Sentry?",
    answer:
      "Yes! Our SDK is designed to be a drop-in replacement. In most cases, you just need to swap the import and update your DSN. We're also working on a migration tool that imports your existing project settings and alert rules.",
  },
  {
    question: "Is the self-hosted version full-featured?",
    answer:
      "Yes, the self-hosted version includes all core features: unlimited error tracking, issue management, alerts, and uptime monitoring. The only difference is that AI fixes require bringing your own Anthropic API key. There are no artificial limitations on the open source version.",
  },
  {
    question: "What about data retention?",
    answer:
      "Data retention varies by plan: 7 days on Free, 90 days on Pro, and 365 days on Team. Self-hosted users can configure unlimited retention. All plans include unlimited error ingestion—retention only affects how long we store the event data.",
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="container mx-auto px-4 py-24">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Frequently asked{" "}
          <span className="text-accent">questions</span>
        </h2>
        <p className="text-lg text-muted-foreground">
          Everything you need to know about BugWatch.
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        {faqs.map((faq, index) => (
          <div key={index} className="mb-3">
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className={`w-full p-5 rounded-xl glass-card text-left transition-colors ${
                openIndex === index ? "border-accent/30" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium pr-8">{faq.question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                    openIndex === index ? "rotate-180" : ""
                  }`}
                />
              </div>
              {openIndex === index && (
                <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
                  {faq.answer}
                </p>
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
