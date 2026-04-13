# frozen_string_literal: true

module Bugwatch
  module Rack
    class Middleware
      def initialize(app)
        @app = app
      end

      def call(env)
        @app.call(env)
      rescue StandardError => e
        capture_exception(e, env)
        raise
      end

      private

      def capture_exception(exception, env)
        context = extract_request_context(env)
        Bugwatch.capture_exception(exception, context: context)
      end

      def extract_request_context(env)
        request = ::Rack::Request.new(env) if defined?(::Rack::Request)

        context = {
          method: env["REQUEST_METHOD"],
          url: env["REQUEST_URI"] || build_url(env),
          query_string: env["QUERY_STRING"],
          headers: extract_headers(env),
          remote_addr: env["REMOTE_ADDR"]
        }

        if request
          context[:content_type] = request.content_type
          context[:content_length] = request.content_length
        end

        context
      end

      def build_url(env)
        scheme = env["rack.url_scheme"] || "http"
        host = env["HTTP_HOST"] || env["SERVER_NAME"]
        path = env["PATH_INFO"]
        query = env["QUERY_STRING"]

        url = "#{scheme}://#{host}#{path}"
        url += "?#{query}" unless query.nil? || query.empty?
        url
      end

      def extract_headers(env)
        env.each_with_object({}) do |(key, value), headers|
          next unless key.start_with?("HTTP_")

          header_name = key.sub("HTTP_", "").split("_").map(&:capitalize).join("-")
          headers[header_name] = value
        end
      end
    end
  end
end
