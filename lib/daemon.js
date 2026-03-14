import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Detiene una tarea del agente de manera segura.
 * @param taskId - ID de la tarea a detener.
 * @returns {Promise<void>}
 */
export async function stopTask(taskId: string): Promise<void> {
  try {
    // Validación de inputs
    if (!taskId) {
      throw new Error('El ID de la tarea es requerido');
    }

    // Verificar si la tarea existe
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error(`La tarea con ID ${taskId} no existe`);
    }

    // Detener la tarea
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'stopped' },
    });

    logger.info(`Tarea con ID ${taskId} detenida con éxito`);
  } catch (error) {
    logger.error(`Error al detener la tarea con ID ${taskId}: ${error.message}`);
    throw error;
  }
}