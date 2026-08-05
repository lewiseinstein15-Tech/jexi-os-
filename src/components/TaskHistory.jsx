import { motion } from 'framer-motion';
import { ListTodo } from 'lucide-react';

export default function TaskHistory({ history }) {
  return (
    <div className="glass p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <ListTodo className="w-4 h-4 text-[#00FF9D]" />
        <h2 className="text-sm font-bold text-[#00FF9D]">TASK HISTORY</h2>
      </div>
      {history.length === 0 ? <p className="text-xs text-gray-500">No tasks executed yet.</p> : (
        <div className="space-y-2">
          {history.map(task => (
            <motion.div key={task.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="bg-black/30 p-3 rounded-lg border border-[#00ff9d11]">
              <p className="text-xs text-gray-200">{task.query}</p>
              <p className="text-[9px] text-gray-500 mt-1">{task.time}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
