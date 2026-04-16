# frozen_string_literal: true

module Bugwatch
  module Rails
    class Railtie < ::Rails::Railtie
      initializer "bugwatch.middleware" do |app|
        app.middleware.insert(0, Bugwatch::Rack::Middleware)
      end

      config.after_initialize do
        Bugwatch.configuration.environment ||= Rails.env.to_s if Bugwatch.configured?
      end
    end
  end
end
