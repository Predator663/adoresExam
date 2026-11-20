from django.urls import path
from rest_framework.routers import DefaultRouter

from . import shares, views

router = DefaultRouter()
router.register("questions", views.QuestionViewSet, basename="question")
router.register("question-shares", shares.QuestionShareViewSet, basename="question-share")

urlpatterns = [path("question-images/", views.upload_image)] + router.urls
