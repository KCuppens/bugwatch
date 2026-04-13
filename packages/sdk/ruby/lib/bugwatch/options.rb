# frozen_string_literal: true

module Bugwatch
  class Configuration
    attr_accessor :api_key, :environment, :release, :server_url, :debug, :before_send

    def initialize
      @api_key = ENV.fetch("BUGWATCH_API_KEY", nil)
      @environment = ENV.fetch("BUGWATCH_ENVIRONMENT", nil)
      @release = ENV.fetch("BUGWATCH_RELEASE", nil)
      @server_url = "https://api.bugwatch.dev"
      @debug = ENV.fetch("BUGWATCH_DEBUG", "false").downcase == "true"
      @before_send = nil
    end

    def valid?
      !@api_key.nil? && !@api_key.empty?
    end
  end
end
