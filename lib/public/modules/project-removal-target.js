// project-removal-target.js - Selects the destination after removing the active project

export function chooseProjectAfterRemoval(projects, removedSlug) {
  var visibleProjects = projects.filter(function (project) {
    return !project.isMate;
  });
  var removedIndex = visibleProjects.findIndex(function (project) {
    return project.slug === removedSlug;
  });
  var remainingProjects = visibleProjects.filter(function (project) {
    return project.slug !== removedSlug;
  });

  if (removedSlug.indexOf("--") !== -1) {
    var parentSlug = removedSlug.split("--")[0];
    var parentProject = remainingProjects.find(function (project) {
      return project.slug === parentSlug;
    });
    if (parentProject) return parentProject.slug;
  }

  if (remainingProjects.length === 0) return null;
  if (removedIndex < 0) return remainingProjects[0].slug;

  return remainingProjects[Math.min(removedIndex, remainingProjects.length - 1)].slug;
}
