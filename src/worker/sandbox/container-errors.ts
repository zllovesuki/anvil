export const NO_CONTAINER_INSTANCE_ERROR_SUBSTRING = "there is no container instance";
export const CONTAINER_NOT_RUNNING_ERROR_SUBSTRING = "container is not running";

export const isNoContainerInstanceError = (error: unknown): boolean =>
  [NO_CONTAINER_INSTANCE_ERROR_SUBSTRING, CONTAINER_NOT_RUNNING_ERROR_SUBSTRING].some((substring) =>
    (error instanceof Error ? error.message : String(error)).toLowerCase().includes(substring),
  );
