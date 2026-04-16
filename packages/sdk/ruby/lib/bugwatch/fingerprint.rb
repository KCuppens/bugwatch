# frozen_string_literal: true

require "digest"

module Bugwatch
  module Fingerprint
    def self.generate(event)
      parts = []

      if event.exception
        parts << event.exception.type.to_s
        parts << event.exception.value.to_s

        first_in_app = event.exception.stacktrace.find(&:in_app)
        if first_in_app
          parts << first_in_app.filename.to_s
          parts << first_in_app.lineno.to_s
          parts << first_in_app.function.to_s
        end
      elsif event.message
        parts << event.message
      end

      Digest::SHA256.hexdigest(parts.join("|"))
    end
  end
end
