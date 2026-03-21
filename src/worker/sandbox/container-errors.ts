export const NO_CONTAINER_INSTANCE_ERROR_SUBSTRING = "there is no container instance";

export const isNoContainerInstanceError = (error: unknown): boolean =>
  (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .includes(NO_CONTAINER_INSTANCE_ERROR_SUBSTRING);
