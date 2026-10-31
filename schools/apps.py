from django.apps import AppConfig


class SchoolsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "schools"
    verbose_name = "Schools"

    def ready(self):
        # The web app of a school runs on its own address; the browser may call the API only from addresses registered as a school's Domain.
        from django.db.models.signals import post_delete, post_save

        from . import cors
        from .models import Domain, School

        cors.connect()
        for model in (Domain, School):
            post_save.connect(cors.forget, sender=model, dispatch_uid=f"schools.cors.save.{model.__name__}")
            post_delete.connect(cors.forget, sender=model, dispatch_uid=f"schools.cors.delete.{model.__name__}")
